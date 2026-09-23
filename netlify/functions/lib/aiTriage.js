// AI triage — server-side only. Calls Claude to classify a new support
// ticket using structured (forced tool-call) output, so the result is
// always well-formed JSON, never free text to parse.
//
// Required env var: ANTHROPIC_API_KEY. Optional: ANTHROPIC_MODEL to
// override the default model (see below) — never lower it for cost
// without being asked; that's a deliberate choice, not a default.
//
// On any failure (missing key, API error, timeout) this returns
// { ok: false, reason }, never throws — the caller escalates to a
// human instead of blocking ticket processing. The ticket sync itself
// must keep working even when Claude is unavailable.
const { CATEGORIES } = require('./safety.js')

const DEFAULT_MODEL = 'claude-opus-5'
const REQUEST_TIMEOUT_MS = 20_000

const SYSTEM_PROMPT = `You are the first-line triage assistant for A-IT, a UK managed IT and cybersecurity provider for small and medium businesses. You read one new support ticket and classify it — you do not attempt to fix anything yourself, and you have no access to any system beyond what's described in this ticket.

## Severity

P1 Critical — suspected account compromise, confirmed or suspected security incident, ransomware/malware outbreak, admin account compromise, major business-wide outage, critical data loss, widespread email failure, backup/recovery emergency.
P2 High — significant business impact, multiple users affected, an important service unavailable, a security issue needing urgent investigation, a serious Microsoft 365 or endpoint problem.
P3 Medium — a single-user issue, a normal business IT problem, a standard Microsoft 365 issue, an endpoint issue with a workaround, routine technical support.
P4 Low — a general or information request, a non-urgent configuration request, a routine administrative task.

These are examples, not an exhaustive list — use judgement for tickets that don't match one exactly. Always prefer escalating a potentially serious security issue over under-classifying it. When genuinely unsure between two levels, pick the more urgent one and lower your confidence instead.

## Category

Choose exactly one: ${CATEGORIES.join(', ')}.

## Rules — these are not optional

- Never claim to have fixed something, changed a setting, or taken any technical action. You have not — you are only reading and classifying this ticket.
- Never promise a resolution time. A's response-time SLA (where a customer has it) is a commitment to respond, not to resolve.
- Never invent A-IT policy, pricing, or technical facts you don't have.
- If you suggest a customer-facing response, keep it professional, concise, and limited to: acknowledging receipt, asking for missing information (a screenshot, an error message, when it started), or confirming the ticket has been escalated to a technician. Do not attempt troubleshooting steps.
- Lower your confidence whenever the ticket is ambiguous, technical details are missing, or the situation could plausibly be more serious than it first appears.

Respond only by calling the submit_triage tool.`

function buildUserPrompt({ ticket, client, priorTickets }) {
  const lines = [
    `Summary: ${ticket.summary || '(none given)'}`,
    `Description: ${ticket.description || '(none given)'}`,
    '',
    'Customer context:',
  ]
  if (client) {
    lines.push(
      `- Business: ${client.business_name}`,
      `- Package tier: ${client.tier}`,
      `- Has the 2-hour response SLA add-on: ${client.sla_addon ? 'yes' : 'no'}`,
      `- Account status: ${client.status}`,
    )
  } else {
    lines.push('- Not yet matched to a known customer account.')
  }
  if (priorTickets?.length) {
    lines.push('', `Recent prior tickets from this customer (${priorTickets.length}):`)
    priorTickets.slice(0, 5).forEach((t) => lines.push(`- [${t.severity || '?'}] ${t.summary || t.jira_issue_key} (${t.jira_status || 'unknown status'})`))
  } else {
    lines.push('', 'No prior ticket history for this customer.')
  }
  return lines.join('\n')
}

const TRIAGE_TOOL = {
  name: 'submit_triage',
  description: 'Submit the triage classification for this support ticket.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      severity: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'] },
      category: { type: 'string', enum: CATEGORIES },
      confidence: { type: 'integer', minimum: 0, maximum: 100, description: 'Confidence in this classification, 0-100.' },
      reasoning: { type: 'string', description: 'One or two sentences on why this severity and category.' },
      suggested_labels: { type: 'array', items: { type: 'string' }, description: 'Short Jira labels to apply, e.g. "ai-triaged".' },
      customer_response: { type: 'string', description: 'A low-risk acknowledgement/info-request message, or an empty string if none is appropriate.' },
    },
    required: ['severity', 'category', 'confidence', 'reasoning', 'suggested_labels', 'customer_response'],
    additionalProperties: false,
  },
}

async function triageTicket({ ticket, client, priorTickets }) {
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
      max_tokens: 1024,
      output_config: { effort: 'low' }, // cost-sensitive: runs on every new ticket
      system: SYSTEM_PROMPT,
      tools: [TRIAGE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_triage' },
      messages: [{ role: 'user', content: buildUserPrompt({ ticket, client, priorTickets }) }],
    })

    if (response.stop_reason === 'refusal') {
      return { ok: false, reason: 'refusal' }
    }

    const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'submit_triage')
    if (!toolUse) return { ok: false, reason: 'no_tool_call' }

    const input = toolUse.input
    return {
      ok: true,
      severity: input.severity,
      category: input.category,
      confidence: input.confidence,
      reasoning: input.reasoning,
      suggestedLabels: Array.isArray(input.suggested_labels) ? input.suggested_labels : [],
      customerResponse: input.customer_response || '',
    }
  } catch (err) {
    // Never let a Claude outage block ticket processing — the caller
    // falls back to human escalation. Distinguish the common cases for
    // whoever reads the audit log / function logs, nothing more.
    const reason = err?.status === 429 ? 'rate_limited' : err?.status >= 500 ? 'anthropic_unavailable' : 'api_error'
    return { ok: false, reason, error: err?.message }
  }
}

module.exports = { triageTicket }
