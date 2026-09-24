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
