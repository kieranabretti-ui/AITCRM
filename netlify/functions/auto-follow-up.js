// Scheduled function (see netlify.toml) — the automated half of the
// follow-up cadence in lib/sales.js's isFollowUpDue() (client-side)
// and README section 15. Once a day: for every opportunity that's
// been emailed, hasn't been marked "They've replied," isn't already
// won or lost, and is FOLLOW_UP_DUE_DAYS or more since that last
// send, this drafts a follow-up with the same AI assistant used
// everywhere else on the Sales page (lib/salesAssistant.js) and sends
// it via Resend — no human click, unlike every other send in this app.
//
// This is opt-in, deliberately: it does nothing at all unless
// AUTO_FOLLOW_UP_ENABLED is set. There is no inbox integration in
// this app, so it has no way to know a prospect actually replied —
// only whether someone ticked the "They've replied" box in time.
// Turning this on trades "a human reviews every send before it goes"
// for "a human has to remember to tick replied before day 5" — a real
// behaviour change, not just a convenience toggle. Read README
// section 15 before switching it on.
//
// Required environment variables (Netlify: Site configuration ->
// Environment variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
//   RESEND_API_KEY, OUTREACH_FROM_EMAIL      see lib/emailSender.js
//   AUTO_FOLLOW_UP_ENABLED=1                 the opt-in switch —
//                                             unset or any other value,
//                                             this function no-ops
const { createClient } = require('@supabase/supabase-js')
const { draftSalesMessage } = require('./lib/salesAssistant.js')
const { isConfigured, sendEmail } = require('./lib/emailSender.js')

// Mirrors FOLLOW_UP_DUE_DAYS/isFollowUpDue() in src/lib/sales.js —
// reimplemented here since the frontend is an ES module and this
// function is CommonJS; keep these in sync if the threshold or the
// won/lost exclusion ever changes.
const FOLLOW_UP_DUE_DAYS = 5

// Same prompts as the 'no_reply_followup'/'later_followup' entries in
// DRAFT_GOALS, src/lib/sales.js — keep in sync.
const FIRST_FOLLOW_UP_GOAL = 'Draft a brief, friendly follow-up email since there has been no reply to the last message.'
const LATER_FOLLOW_UP_GOAL = 'Draft a brief, low-pressure final check-in email. This is at least the second follow-up with no reply, so acknowledge that lightly without being pushy or guilt-tripping, keep it noticeably shorter than a first follow-up, and make it genuinely easy to say no or simply not reply — e.g. offering to stop reaching out if now is not the right time.'

// Same prefixes/logic as pickFollowUpGoalId() in src/lib/sales.js —
// reimplemented here for the same ESM/CJS reason as everything else
// mirrored in this file. Counts how many outreach emails this
// client's activity log already shows were sent (manual or
// automated), so the second-or-later no-reply follow-up doesn't keep
// reusing the same "just checking in" framing indefinitely.
const OUTREACH_ACTIVITY_PREFIXES = ['Outreach email sent to', 'Follow-up email sent automatically']
function pickFollowUpGoal(client) {
  const priorSends = (client.client_activity || []).filter((a) => OUTREACH_ACTIVITY_PREFIXES.some((prefix) => a.text?.startsWith(prefix))).length
  return priorSends >= 2 ? LATER_FOLLOW_UP_GOAL : FIRST_FOLLOW_UP_GOAL
}

// Safety cap, not an expected volume — so a backlog (e.g. the first
// run right after this is switched on) can't fire off a burst of
// real emails all in one go.
const MAX_PER_RUN = 20

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

exports.handler = async () => {
  if (process.env.AUTO_FOLLOW_UP_ENABLED !== '1') {
    return { statusCode: 200, body: JSON.stringify({ skipped: 'AUTO_FOLLOW_UP_ENABLED is not set' }) }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[auto-follow-up] missing Supabase env vars')
    return { statusCode: 500 }
  }
  if (!isConfigured()) {
    console.error('[auto-follow-up] email sending is not configured (RESEND_API_KEY / OUTREACH_FROM_EMAIL)')
    return { statusCode: 500 }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const dueBefore = new Date(Date.now() - FOLLOW_UP_DUE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: dueOpportunities, error } = await admin
    .from('sales_opportunities')
    .select('*')
    .not('outreach_sent_at', 'is', null)
    .is('replied_at', null)
    .lte('outreach_sent_at', dueBefore)
    .not('stage', 'in', '(won,lost)')
    .limit(MAX_PER_RUN)
  if (error) {
    console.error('[auto-follow-up] could not load due opportunities:', error.message)
    return { statusCode: 500 }
  }

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const opportunity of dueOpportunities || []) {
    try {
      const { data: client, error: clientError } = await admin
        .from('clients')
        .select('*, client_activity(*)')
        .eq('id', opportunity.client_id)
        .maybeSingle()
      if (clientError || !client) throw new Error(clientError?.message || 'client not found')

      if (!client.contact_email || !EMAIL_RE.test(client.contact_email)) {
        skipped++
        continue
      }
      const goal = pickFollowUpGoal(client)
      client.activity = (client.client_activity || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

      const draft = await draftSalesMessage({ client, opportunity, goal })
      if (!draft.ok) {
        console.error(`[auto-follow-up] could not draft for opportunity ${opportunity.id}: ${draft.reason}`)
        failed++
        continue
      }

      const result = await sendEmail({ to: client.contact_email, subject: draft.subject, text: draft.body })
      if (!result.ok) {
        console.error(`[auto-follow-up] could not send for opportunity ${opportunity.id}: ${result.reason}`)
        failed++
        continue
      }

      const sentAt = new Date().toISOString()
      const { error: updateError } = await admin.from('sales_opportunities').update({
        ai_draft_message: { subject: draft.subject, body: draft.body, key_points: draft.keyPoints, follow_up_suggestion: draft.followUpSuggestion },
        ai_draft_generated_at: sentAt,
        outreach_sent_at: sentAt,
        outreach_sent_to: client.contact_email,
        outreach_sent_subject: draft.subject,
        outreach_sent_body: draft.body,
        // A fresh send starts a fresh cadence — same reasoning as the
        // manual send path in send-outreach-email.js.
        replied_at: null,
        updated_at: sentAt,
      }).eq('id', opportunity.id)
      if (updateError) {
        console.error(`[auto-follow-up] sent but could not update opportunity ${opportunity.id}:`, updateError.message)
      }

      // Deliberately worded differently from a manual send's activity
      // entry (send-outreach-email.js) — this one should always be
      // obviously distinguishable in the log as something that
      // happened without a human clicking Send.
      await admin.from('client_activity').insert({
        client_id: client.id,
        text: `Follow-up email sent automatically (${FOLLOW_UP_DUE_DAYS}+ days, no reply marked) to ${client.contact_email}\nSubject: ${draft.subject}`,
      })

      sent++
    } catch (err) {
      console.error(`[auto-follow-up] failed for opportunity ${opportunity.id}:`, err.message)
      failed++
    }
  }

  console.log(`[auto-follow-up] sent ${sent}, skipped ${skipped} (no valid email), failed ${failed}, of ${(dueOpportunities || []).length} due`)
  return { statusCode: 200, body: JSON.stringify({ sent, skipped, failed, due: (dueOpportunities || []).length }) }
}
