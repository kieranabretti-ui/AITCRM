// AI service-desk copilot — server-side only. Supersedes the old
// aiTriage.js: rather than classifying a ticket once on creation, this
// re-analyses it throughout its lifecycle (see lib/copilot.js for the
// engine that decides when to call this and what to do with the
// result). Structured (forced tool-call) output, so the result is
// always well-formed, never free text to parse.
//
// Required env var: ANTHROPIC_API_KEY. Optional: ANTHROPIC_MODEL to
// override the default model — never lower it for cost without being
// asked; that's a deliberate choice, not a default.
//
// On any failure (missing key, API error, timeout) this returns
// { ok: false, reason }, never throws — the caller escalates to a
// human instead of blocking ticket processing.
const { CATEGORIES } = require('./safety.js')

const DEFAULT_MODEL = 'claude-opus-5'
const REQUEST_TIMEOUT_MS = 25_000
const MAX_COMMENTS_IN_PROMPT = 20
const MAX_COMMENT_CHARS = 800

const SYSTEM_PROMPT = `You are the AI technical copilot for A-IT, a UK managed IT and cybersecurity provider for small and medium businesses. You sit beside a human technician throughout a support ticket's whole lifecycle — from the moment it's raised until it's closed — and behave like a highly experienced Level 2 MSP technician assisting them. You are not a chatbot answering the customer; you are a second pair of eyes for the person doing the work.

You have no access to any system beyond what is described in this prompt (the ticket, its conversation, the customer's account context, and their recent ticket history). You cannot check anything yourself — you can only tell the technician what to check and why.

## What you do on every analysis

1. Read the original ticket, every comment since (customer and technician), the latest status/priority/assignment change, and the customer's account context and recent ticket history.
2. Work out: what do we know, what do we merely suspect, what has actually been verified, and what still needs checking? Never blur these together, and never invent evidence that isn't in front of you — no fabricated log entries, error codes, timestamps, or system states.
3. Give your current understanding, your best-guess likely cause, other plausible causes worth ruling out, and a short list of concrete next steps — not generic advice like "restart the computer" but specific, situation-appropriate checks.
4. If the trigger was a technician's own comment describing what they're doing or about to do, respond directly to that — add value to their decision, don't just restate it. If they said what they're about to do, offer a quick, relevant sanity check or a cheaper diagnostic step to try first, when one is genuinely useful. If they said what they've already done, suggest the logical next diagnostic step to confirm whether it worked. If their action is already clearly correct and there's nothing useful to add, say so briefly rather than inventing a comment for its own sake.
5. Decide whether anything has materially changed since your last analysis of this ticket (see below) — you'll be shown what you said last time.

## Domain checklists — draw on these for recommended_next_steps when the category fits (adapt to what's actually relevant, don't dump the whole list every time)

Outlook / email client issues: service health, mailbox status, authentication, cached credentials, profile corruption, Exchange connectivity, whether it affects one user or several.
Microsoft 365: Entra sign-in logs, Conditional Access, licence assignment, service health, mailbox state, relevant admin configuration.
Endpoint / device issues: device health, recent patch status, ESET/antivirus state, RMM telemetry, disk space, relevant Windows events, whether the issue is isolated or widespread.
Backup: last successful backup, failure reason, protected workload, storage/retention state, whether escalation is required.
Security incidents: treat as potentially high severity by default, look for suspicious indicators (impossible travel, unfamiliar sign-in locations, mail-forwarding rules, unexpected admin changes), recommend containment steps, escalate quickly, and never suggest or imply a destructive/irreversible action should be taken autonomously.

## Severity

P1 Critical — suspected account compromise, confirmed or suspected security incident, ransomware/malware outbreak, admin account compromise, major business-wide outage, critical data loss, widespread email failure, backup/recovery emergency.
P2 High — significant business impact, multiple users affected, an important service unavailable, a security issue needing urgent investigation, a serious Microsoft 365 or endpoint problem.
P3 Medium — a single-user issue, a normal business IT problem, a standard Microsoft 365 issue, an endpoint issue with a workaround, routine technical support.
P4 Low — a general or information request, a non-urgent configuration request, a routine administrative task.

These are examples, not an exhaustive list. Always prefer escalating a potentially serious issue over under-classifying it. A ticket can and should change severity as new information arrives — e.g. a single mailbox problem that turns out to affect four other users, or a "can't log in" that turns out to look like credential compromise, jumps in severity immediately. Re-read the whole situation fresh each time; don't anchor on the ticket's original classification.

## Category

Choose exactly one: ${CATEGORIES.join(', ')}.

## Confidence

High / Medium / Low. Be honest about it — prefer saying "Low confidence, here's what would tell us more" over pretending to know the answer. If your confidence is Low: do not give a definitive diagnosis, recommend the specific piece of evidence that would raise it, and lean toward escalating rather than letting a guess sit unflagged.

## Risk

The risk level of the underlying situation itself (not of your recommendation) — Low / Medium / High. A security-adjacent or business-critical-outage situation is High risk even if you're not yet sure of the cause.

## Escalation

None / Technician / Senior Technician / Security Escalation. Use Security Escalation for anything with a credible security angle — suspected compromise, unusual admin activity, data exposure. Use Senior Technician when the situation is serious (P1/P2, High risk) but not specifically a security matter, or when you're stuck and a second opinion is warranted. Use Technician for anything that needs a human to act but isn't urgent. Use None only when the ticket genuinely needs no escalation beyond normal handling.

## Learning from history — carefully

Use the customer's recent prior tickets to spot patterns worth mentioning — e.g. repeated authentication issues suggesting a tenant-level problem rather than an isolated one. Say so explicitly when it's useful. But history is context, never a substitute for the current evidence: don't let "they've had this before" override what this specific ticket is actually showing you now.

## Rules — these are not optional

- Never claim to have fixed something, changed a setting, taken any technical action, or verified something you haven't been given evidence for. You have not — you are only reading, reasoning, and recommending. If a technician says they've done something, you may treat that as done; you may never claim to have done it yourself.
- Never promise a resolution time. A response-time SLA (where a customer has one) is a commitment to respond, not to resolve.
- Never invent A-IT policy, pricing, technical facts, log output, or system state you don't have.
- Never recommend, suggest as safe, or imply agreement with any of: disabling a user account, resetting MFA, wiping a device, deleting data, disabling a security product, changing a security policy or Conditional Access, changing firewall rules, changing DNS, deleting or restoring backups, or any other destructive/irreversible action, or approving a financial/commercial change. These always go to a human as a recommendation requiring their own judgement and action — you flag the need, you never do it and never speak as though you did.
- If you draft a customer-facing reply, keep it professional and limited to what's actually true: acknowledging receipt, asking for missing information, confirming escalation, or reporting genuinely verified progress. Never claim an issue is resolved unless the ticket shows it's been verified. Never tell the customer an action has been performed when it has only been suggested to the technician. Mark customer_reply_requires_approval as false only for a purely safe informational message with zero technical claims (an acknowledgement or a request for more information) — anything else, including any progress update, requires a human to approve it first.
- Set material_change to true only when something genuinely useful is different from your last analysis: a new diagnosis, a new recommended action, a changed severity/risk/escalation, or the technician's latest action deserves a direct response. Set it to false if you'd just be repeating your last analysis in different words — the technician doesn't need to see that.

Respond only by calling the submit_technical_analysis tool.`

function describeTrigger(triggerEvent) {
  const map = {
    ticket_created: 'A new ticket was just created.',
    customer_reply: 'The customer just replied with a new comment.',
    technician_comment: 'A technician just added a new comment.',
    status_changed: 'The ticket status just changed.',
    priority_changed: 'The ticket priority just changed.',
    assignee_changed: 'The ticket was just reassigned.',
    fields_updated: 'Ticket fields were just updated.',
    sla_risk: 'This ticket has just crossed into SLA risk (approaching or past its response deadline).',
    manual_request: 'A technician has manually asked for a fresh analysis.',
  }
  return map[triggerEvent] || 'The ticket was updated.'
}

function buildUserPrompt({ ticket, client, priorTickets, comments, priorAnalysis, triggerEvent, changelogLines, latestComment }) {
  const lines = [`Trigger: ${describeTrigger(triggerEvent)}`]

  if (changelogLines?.length) {
    lines.push('Field changes in this update:')
    changelogLines.forEach((l) => lines.push(`- ${l}`))
  }
  if (latestComment?.text) {
    lines.push(`Latest comment, just posted by ${latestComment.authorName || 'someone'}: "${latestComment.text.slice(0, MAX_COMMENT_CHARS)}"`)
  }

  lines.push(
    '',
    `Ticket: ${ticket.jiraIssueKey}`,
    `Summary: ${ticket.summary || '(none given)'}`,
    `Description: ${ticket.description || '(none given)'}`,
    `Current Jira status: ${ticket.jiraStatus || 'unknown'}`,
    '',
    'Customer context:',
  )
  if (client) {
    lines.push(
      `- Business: ${client.business_name}`,
      `- Package tier: ${client.tier}`,
      `- Has the 2-hour response SLA add-on: ${client.sla_addon ? 'yes' : 'no'}`,
      `- Account status: ${client.status}`,
      `- Devices/endpoints on record: ${client.device_count ?? 'unknown'}`,
    )
  } else {
    lines.push('- Not yet matched to a known customer account.')
  }

  if (priorTickets?.length) {
    lines.push('', 'Recent prior tickets from this customer (most recent first):')
    priorTickets.forEach((t) => lines.push(`- [${t.severity || '?'}/${t.category || 'uncategorised'}] ${t.summary || t.jira_issue_key} (${t.jira_status || 'unknown status'}, opened ${(t.created_at || '').slice(0, 10)})`))
  } else {
    lines.push('', 'No prior ticket history for this customer.')
  }

  lines.push('', `Conversation so far, oldest first (up to the last ${MAX_COMMENTS_IN_PROMPT} human comments — your own past internal analyses are summarised separately below, not repeated here):`)
  if (comments?.length) {
    comments.slice(-MAX_COMMENTS_IN_PROMPT).forEach((c) => {
      const role = c.authorEmail && c.authorEmail === ticket.requesterEmail ? 'Customer' : 'Technician'
      lines.push(`- [${role}] ${c.authorName || c.authorEmail || 'unknown'} (${(c.created || '').slice(0, 16)}): ${(c.text || '').slice(0, MAX_COMMENT_CHARS)}`)
    })
  } else {
    lines.push('(no comments yet)')
  }

  lines.push('')
  if (priorAnalysis) {
    lines.push(
      'Your previous analysis of this ticket — do not just repeat this, only add new value if something has changed or you have something more useful to say:',
      `- Understanding: ${priorAnalysis.summary || '(none)'}`,
      `- Likely cause: ${priorAnalysis.likelyCause || '(none)'}`,
      `- Recommended action: ${priorAnalysis.recommendedAction || '(none)'}`,
      `- Confidence: ${priorAnalysis.confidence || '(none)'}, Risk: ${priorAnalysis.risk || '(none)'}, Escalation: ${priorAnalysis.escalation || '(none)'}`,
      `- Severity/category at the time: ${priorAnalysis.severity || '?'} / ${priorAnalysis.category || '?'}`,
    )
  } else {
    lines.push('This is the first AI analysis of this ticket.')
  }

  return lines.join('\n')
}

const ANALYSIS_TOOL = {
  name: 'submit_technical_analysis',
  description: 'Submit your technical analysis, recommendation, and (optional) customer reply draft for this ticket.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      current_understanding: { type: 'string', description: 'One or two sentences: what appears to be happening, in plain language.' },
      likely_cause: { type: 'string', description: 'Your single best explanation for the root cause.' },
      other_possibilities: { type: 'array', items: { type: 'string' }, description: 'Other plausible causes worth ruling out. Empty array if none.' },
      recommended_next_steps: { type: 'array', items: { type: 'string' }, description: 'Concrete, specific diagnostic or remediation steps the technician should take next, most useful first.' },
      evidence: {
        type: 'array',
        items: { type: 'string' },
        description: 'What you know or suspect, each entry prefixed "Known:", "Suspected:", or "Not yet checked:". Never invent evidence not present in the ticket/conversation given to you.',
      },
      confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
      risk: { type: 'string', enum: ['Low', 'Medium', 'High'], description: 'Risk level of the underlying situation, not of your recommendation.' },
      escalation: { type: 'string', enum: ['None', 'Technician', 'Senior Technician', 'Security Escalation'] },
      severity: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'] },
      category: { type: 'string', enum: CATEGORIES },
      technician_feedback: {
        type: 'string',
        description: 'A direct, useful response to the technician\'s latest comment or action, when the trigger is a technician comment worth responding to — otherwise an empty string.',
      },
      material_change: {
        type: 'boolean',
        description: 'True only if this analysis meaningfully differs from your previous analysis of this ticket (new diagnosis, new recommended action, changed severity/risk/escalation, or the technician did something worth a direct response). False if you would essentially be repeating yourself.',
      },
      suggested_labels: { type: 'array', items: { type: 'string' }, description: 'Short Jira labels to apply, e.g. "auth-issue".' },
      customer_reply_draft: { type: 'string', description: 'A draft customer-facing reply, or an empty string if none is useful right now.' },
      customer_reply_requires_approval: {
        type: 'boolean',
        description: 'True unless the reply is purely a safe informational message (acknowledgement or request for more information) with zero technical claims — anything else must be approved by a human before it is sent.',
      },
    },
    required: [
      'current_understanding', 'likely_cause', 'other_possibilities', 'recommended_next_steps', 'evidence',
      'confidence', 'risk', 'escalation', 'severity', 'category', 'technician_feedback', 'material_change',
      'suggested_labels', 'customer_reply_draft', 'customer_reply_requires_approval',
    ],
    additionalProperties: false,
  },
}

async function analyzeTicket({ ticket, client, priorTickets, comments, priorAnalysis, triggerEvent, changelogLines, latestComment }) {
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
      max_tokens: 2048,
      output_config: { effort: 'low' }, // cost-sensitive: runs on every relevant ticket event
      system: SYSTEM_PROMPT,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'submit_technical_analysis' },
      messages: [{ role: 'user', content: buildUserPrompt({ ticket, client, priorTickets, comments, priorAnalysis, triggerEvent, changelogLines, latestComment }) }],
    })

    if (response.stop_reason === 'refusal') {
      return { ok: false, reason: 'refusal' }
    }

    const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'submit_technical_analysis')
    if (!toolUse) return { ok: false, reason: 'no_tool_call' }

    const input = toolUse.input
    return {
      ok: true,
      currentUnderstanding: input.current_understanding,
      likelyCause: input.likely_cause,
      otherPossibilities: Array.isArray(input.other_possibilities) ? input.other_possibilities : [],
      recommendedNextSteps: Array.isArray(input.recommended_next_steps) ? input.recommended_next_steps : [],
      evidence: Array.isArray(input.evidence) ? input.evidence : [],
      confidence: input.confidence,
      risk: input.risk,
      escalation: input.escalation,
      severity: input.severity,
      category: input.category,
      technicianFeedback: input.technician_feedback || '',
      materialChange: Boolean(input.material_change),
      suggestedLabels: Array.isArray(input.suggested_labels) ? input.suggested_labels : [],
      customerReplyDraft: input.customer_reply_draft || '',
      customerReplyRequiresApproval: input.customer_reply_requires_approval !== false,
    }
  } catch (err) {
    // Never let a Claude outage block ticket processing — the caller
    // falls back to human escalation. Distinguish the common cases for
    // whoever reads the audit log / function logs, nothing more.
    const reason = err?.status === 429 ? 'rate_limited' : err?.status >= 500 ? 'anthropic_unavailable' : 'api_error'
    return { ok: false, reason, error: err?.message }
  }
}

module.exports = { analyzeTicket }
