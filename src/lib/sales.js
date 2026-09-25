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
  { id: 'later_followup', label: 'Follow-up — still no reply (2nd+)', prompt: 'Draft a brief, low-pressure final check-in email. This is at least the second follow-up with no reply, so acknowledge that lightly without being pushy or guilt-tripping, keep it noticeably shorter than a first follow-up, and make it genuinely easy to say no or simply not reply — e.g. offering to stop reaching out if now is not the right time.' },
  { id: 'proposal_followup', label: 'Follow-up after proposal', prompt: 'Draft a follow-up email checking in after a proposal was sent, offering to answer any questions.' },
  { id: 're_engage', label: 'Re-engage a stalled deal', prompt: 'Draft a re-engagement email for a deal that has gone quiet, low-pressure, checking if priorities have changed.' },
  { id: 'welcome', label: 'Welcome after winning the deal', prompt: 'Draft a warm welcome/next-steps email now that this deal has been won.' },
]

// The activity-log text prefixes each outreach-send path uses — see
// send-outreach-email.js (manual) and auto-follow-up.js (automated).
// Matched here to count how many outreach emails a client has already
// been sent, so a repeated no-reply follow-up doesn't keep reusing the
// same "just following up" framing indefinitely.
const OUTREACH_ACTIVITY_PREFIXES = ['Outreach email sent to', 'Follow-up email sent automatically']

function countPriorOutreachSends(client) {
  const activity = client?.client_activity || []
  return activity.filter((a) => OUTREACH_ACTIVITY_PREFIXES.some((prefix) => a.text?.startsWith(prefix))).length
}

// Which follow-up goal fits an opportunity's client right now: the
// first no-reply follow-up reads naturally as "just checking in," but
// by the second (or later) one with still no reply, the same framing
// starts to sound tone-deaf — so this switches to the shorter,
// lower-pressure 'later_followup' goal once at least one outreach
// email has already gone out before whichever one is about to be
// drafted. Used both for the drawer's auto-selected goal and by
// auto-follow-up.js's automated sender (mirrored there — see that
// file for why it can't just import this one).
export function pickFollowUpGoalId(client) {
  return countPriorOutreachSends(client) >= 2 ? 'later_followup' : 'no_reply_followup'
}

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

// How long to wait, with no reply marked, before flagging an
// opportunity as due a follow-up. A flag only — see isFollowUpDue().
export const FOLLOW_UP_DUE_DAYS = 5

// The follow-up cadence is only "active" for an opportunity that's
// actually been emailed, hasn't had a reply marked, and isn't already
// closed out — shared by isFollowUpDue() and nextFollowUpAt() so the
// two can't quietly disagree about when a cadence even applies.
function isCadenceActive(opportunity) {
  return Boolean(opportunity.outreach_sent_at) && !opportunity.replied_at && opportunity.stage !== 'won' && opportunity.stage !== 'lost'
}

// The ISO timestamp of the next automated-follow-up point for an
// opportunity — in the past if it's already due, in the future if
// not yet. Null when there's no active cadence to schedule at all
// (never sent, already replied, or the deal is closed). Pure and
// read-only.
export function nextFollowUpAt(opportunity) {
  if (!isCadenceActive(opportunity)) return null
  return new Date(new Date(opportunity.outreach_sent_at).getTime() + FOLLOW_UP_DUE_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

// True once that point has actually passed. This never sends
// anything itself — it's what the Sales board's "Follow-up due"
// badge and the opportunity drawer's reminder both read, to surface
// which leads need a human to look at them again, without anything
// happening on its own.
export function isFollowUpDue(opportunity) {
  const dueAt = nextFollowUpAt(opportunity)
  return dueAt != null && Date.now() >= new Date(dueAt).getTime()
}
