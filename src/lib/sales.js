export const STAGES = [
  { id: 'new', label: 'New' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'proposal_sent', label: 'Proposal sent' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
]

export function stageLabel(id) {
  return STAGES.find((s) => s.id === id)?.label || id
}

// Goals the AI draft picker offers — plain-language prompts passed
// straight to the assistant, not a rigid enum it has to map back.
export const DRAFT_GOALS = [
  { id: 'initial_outreach', label: 'Initial outreach', prompt: 'Draft an initial outreach email introducing A-IT and asking to arrange a short call.' },
  { id: 'no_reply_followup', label: 'Follow-up — no reply yet', prompt: 'Draft a brief, friendly follow-up email since there has been no reply to the last message.' },
  { id: 'proposal_followup', label: 'Follow-up after proposal', prompt: 'Draft a follow-up email checking in after a proposal was sent, offering to answer any questions.' },
  { id: 're_engage', label: 'Re-engage a stalled deal', prompt: 'Draft a re-engagement email for a deal that has gone quiet, low-pressure, checking if priorities have changed.' },
  { id: 'welcome', label: 'Welcome after winning the deal', prompt: 'Draft a warm welcome/next-steps email now that this deal has been won.' },
]

// A tie within this window of an opportunity's own creation counts as
// "just added," not "updated" — both created_at and updated_at get
// set to (near enough) the same moment at insert.
const FRESHLY_CREATED_WINDOW_MS = 5000

function summarizeActivity(text) {
  const firstLine = (text || '').split('\n')[0].trim()
  if (!firstLine) return 'Activity logged'
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine
}

// One "what happened most recently" summary for a Sales board card —
// compares every timestamped event this app can produce for an
// opportunity (a logged client activity, an outreach email send, an
// AI draft being generated, or a plain details/stage update) and
// returns whichever actually happened last, so the board itself shows
// current state at a glance instead of requiring the drawer to open.
// Pure and read-only — never mutates the opportunity passed in.
export function computeLastAction(opportunity) {
  const candidates = []

  const activity = opportunity.clients?.client_activity || []
  const latestActivity = activity.reduce(
    (latest, a) => (!latest || new Date(a.created_at) > new Date(latest.created_at) ? a : latest),
    null,
  )
  if (latestActivity) {
    candidates.push({ at: latestActivity.created_at, label: summarizeActivity(latestActivity.text) })
  }

  if (opportunity.outreach_sent_at) {
    candidates.push({ at: opportunity.outreach_sent_at, label: 'Outreach email sent' })
  }
  if (opportunity.ai_draft_generated_at) {
    candidates.push({ at: opportunity.ai_draft_generated_at, label: 'AI draft generated' })
  }
  if (opportunity.updated_at) {
    const createdMs = opportunity.created_at ? new Date(opportunity.created_at).getTime() : null
    const updatedMs = new Date(opportunity.updated_at).getTime()
    const freshlyCreated = createdMs != null && Math.abs(updatedMs - createdMs) < FRESHLY_CREATED_WINDOW_MS
    candidates.push({ at: opportunity.updated_at, label: freshlyCreated ? 'Added to pipeline' : 'Details updated' })
  }

  if (!candidates.length) return null
  return candidates.reduce((latest, c) => (new Date(c.at) > new Date(latest.at) ? c : latest))
}
