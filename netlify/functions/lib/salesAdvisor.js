// Sales advisor chat — server-side only. A free-form conversational
// "sales guru" for the Sales page: tactical advice on chasing
// prospects, outreach cadence, objection handling, pipeline
// prioritisation. Unlike lib/salesAssistant.js (which drafts one
// email for one opportunity via a forced tool call), this is a plain
// multi-turn conversation with no tool access and nothing it can do
// beyond reply with text — it never drafts into or updates an
// opportunity, never sends anything, and there is no persistence:
// each request carries its own conversation history, kept only in the
// browser tab.
//
// Required env var: ANTHROPIC_API_KEY. Optional: ANTHROPIC_MODEL.
// On any failure this returns { ok: false, reason }, never throws.
const { buildPriceFacts } = require('./pricingFacts.js')

const DEFAULT_MODEL = 'claude-opus-5'
const REQUEST_TIMEOUT_MS = 45_000
const MAX_TOKENS = 1536
const STALE_LIST_SIZE = 5

function daysSince(dateString) {
  if (!dateString) return null
  return Math.floor((Date.now() - new Date(dateString).getTime()) / 86_400_000)
}

// Deliberately a compact summary, not a dump of every field of every
// opportunity — enough for grounded, specific advice ("chase these
// three, here's why") without either bloating the prompt or handing
// the model a pile of client data it doesn't need for a strategy
// conversation. If asked about a prospect that isn't in this
// snapshot, the system prompt tells it to say so rather than guess.
function buildPipelineSnapshot(opportunities) {
  if (!opportunities || opportunities.length === 0) {
    return 'Current pipeline snapshot: empty — no opportunities on the board yet.'
  }

  const open = opportunities.filter((o) => o.stage !== 'won' && o.stage !== 'lost')
  const byStage = {}
  for (const o of open) {
    const key = o.stage || 'unknown'
    byStage[key] = byStage[key] || { count: 0, value: 0 }
    byStage[key].count += 1
    byStage[key].value += Number(o.estimated_value_annual) || 0
  }
  const wonCount = opportunities.filter((o) => o.stage === 'won').length
  const lostCount = opportunities.filter((o) => o.stage === 'lost').length
  const openValue = open.reduce((s, o) => s + (Number(o.estimated_value_annual) || 0), 0)

  const lines = ['Current pipeline snapshot:']
  for (const [stage, { count, value }] of Object.entries(byStage)) {
    lines.push(`- ${stage}: ${count} opportunit${count === 1 ? 'y' : 'ies'}, ~£${value.toLocaleString('en-GB')} estimated`)
  }
  lines.push(`- Won: ${wonCount} · Lost: ${lostCount}`)
  lines.push(`Open pipeline total: ~£${openValue.toLocaleString('en-GB')} across ${open.length} open opportunit${open.length === 1 ? 'y' : 'ies'}.`)

  const stalest = open
    .slice()
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))
    .slice(0, STALE_LIST_SIZE)
  if (stalest.length > 0) {
    lines.push('', 'Opportunities that have gone longest without an update (oldest first):')
    stalest.forEach((o, i) => {
      const days = daysSince(o.updated_at)
      const name = o.clients?.business_name || 'Untitled prospect'
      const value = o.estimated_value_annual ? `£${Number(o.estimated_value_annual).toLocaleString('en-GB')} est.` : 'value unknown'
      lines.push(`${i + 1}. ${name} — ${o.stage} — ${value} — ${days == null ? 'no update date on file' : `${days} day${days === 1 ? '' : 's'} since last update`}`)
    })
  }

  return lines.join('\n')
}

function buildSystemPrompt(pipelineSnapshot) {
  return `You are Kieran's in-house sales guru — an experienced, sharp B2B sales strategist embedded in the CRM for A-IT, a Dorset-based UK managed IT and cybersecurity provider for small and medium businesses. Kieran is the founder, doing his own sales, and most of his prospects (many sourced via the Companies House lead finder) are also Dorset-based businesses. Give him direct, concrete, tactical advice: how to chase a specific prospect, what to say when a deal's gone quiet, how to handle an objection, how to prioritise who to call next, how to structure a follow-up cadence, how to position against competitors — the kind of advice an experienced sales lead would give, not generic platitudes. Being local is a real, usable differentiator against national/remote-only competitors when it's genuinely relevant to the advice — not something to force into every answer.

${buildPriceFacts()}

${pipelineSnapshot}

## Rules — these are not optional

- The pipeline snapshot above is everything you know about A-IT's current deals. If Kieran asks about a specific prospect that isn't named in it, say plainly that you don't have their details in this snapshot and ask him to paste the relevant context (what's been said, where they stalled, etc.) rather than guessing or inventing a history for them.
- Never invent a fact about a prospect, a conversation that didn't happen, or a commitment A-IT hasn't made.
- Never promise a specific response time beyond the SLA figure above, and only for clients who have (or are being offered) that add-on.
- You may draft short outreach copy or suggested lines inline as part of your advice, but for a full, ready-to-send email for a specific opportunity, point Kieran to that opportunity's own "Draft with AI" tool in its drawer — that tool has the full context on that one prospect, which you don't.
- You have no access to email, the phone, or any system — you only ever reply with text in this chat. You cannot look anything up beyond the snapshot above and whatever Kieran tells you in the conversation.
- Keep replies focused and skimmable — a founder reading this between calls, not an essay. Use short paragraphs or a tight bullet list when that's clearer than prose.
- British business tone: direct, practical, no hard-sell clichés or fake urgency.`
}

async function askSalesAdvisor({ messages, opportunities }) {
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

  const systemPrompt = buildSystemPrompt(buildPipelineSnapshot(opportunities))

  try {
    const response = await anthropicClient.beta.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'high' },
      system: systemPrompt,
      messages,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })

    if (response.stop_reason === 'refusal') return { ok: false, reason: 'refusal' }

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n')
      .trim()
    if (!text) return { ok: false, reason: 'empty_reply' }

    return { ok: true, reply: text }
  } catch (err) {
    const reason = err?.status === 429 ? 'rate_limited' : err?.status >= 500 ? 'anthropic_unavailable' : 'api_error'
    return { ok: false, reason, error: err?.message }
  }
}

module.exports = { askSalesAdvisor, buildPipelineSnapshot }
